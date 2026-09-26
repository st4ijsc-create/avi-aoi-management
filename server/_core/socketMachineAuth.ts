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
 * Rollout is gated by SOCKET_MACHINE_AUTH_MODE. Mismatches are counted
 * in-process (getSocketMachineAuthMismatches) and logged structured.
 *
 * ★★★ doc 81 Đợt 1B Task 9 (Ruling R6) — MẶC ĐỊNH TRONG MÃ ĐỔI `off` → `enforce`.
 * BE3 §L4b đo được: cờ vắng trong `.env` ⇒ `off` ⇒ 1.000 socket vô danh vào phòng
 * `machine:17119`, nhận 100 % telemetry, đánh dấu máy online, và bão confirm_mapping
 * làm treo ingest 18,3 s. `off` vẫn đặt được qua env (lối thoát, hành vi cũ nguyên văn);
 * `.env` KHÔNG bị sửa — hiệu lực khi chủ dự án restart.
 *
 * ★ Nhánh legacy (plaintext `machines.apiKey`) nay hỏi CÙNG điểm quyết định với router máy
 * và `/api/v1` (`decideSharedMachineKey`, Task 8): `MACHINE_SHARED_KEY_ALLOWED` (mặc định
 * deny từ mig 0334) + luật mk_-only + sổ weak-auth. Trước đây socket là cửa DUY NHẤT còn nhận
 * khoá dùng chung bất kể cờ.
 */
import { authenticateMachine, decideSharedMachineKey } from "../services/machineAuthService";
import { logger } from "../logger";

// ── mode ─────────────────────────────────────────────────────────────────────

export type SocketMachineAuthMode = "off" | "log" | "enforce";

let badModeWarned: string | null = null;

/** Mặc định trong mã (doc 81 Đợt 1B Task 9, Ruling R6). MỘT hằng — mọi điểm đọc dùng nó. */
export const SOCKET_MACHINE_AUTH_MODE_MAC_DINH: SocketMachineAuthMode = "enforce";

/**
 * `off` | `log` | `enforce` (mặc định). Unrecognised values fall back to the
 * DEFAULT (`enforce`) with ONE error log per distinct value — same "fall back to
 * the flag's default, never to something more permissive" policy as
 * parseWeakAuthPolicy (doc 51 P0). Before Task 9 a typo fell back to `off`, i.e.
 * a typo such as "enforced" silently OPENED the channel.
 */
export function socketMachineAuthMode(): SocketMachineAuthMode {
  const raw = (process.env.SOCKET_MACHINE_AUTH_MODE ?? "").trim().toLowerCase();
  if (raw === "") return SOCKET_MACHINE_AUTH_MODE_MAC_DINH;
  if (raw === "off") return "off";
  if (raw === "log") return "log";
  if (raw === "enforce") return "enforce";
  if (badModeWarned !== raw) {
    badModeWarned = raw;
    logger.error(
      { flag: "SOCKET_MACHINE_AUTH_MODE", value: raw, fallback: SOCKET_MACHINE_AUTH_MODE_MAC_DINH, doc: "81-1B-T9" },
      `[SocketMachineAuth] SOCKET_MACHINE_AUTH_MODE="${raw}" không hợp lệ — chỉ nhận off|log|enforce. ` +
        `Đang dùng mặc định "${SOCKET_MACHINE_AUTH_MODE_MAC_DINH}".`,
    );
  }
  return SOCKET_MACHINE_AUTH_MODE_MAC_DINH;
}

// ── verification ─────────────────────────────────────────────────────────────

/**
 * `legacy-denied` = khoá KHỚP `machines.apiKey` nhưng chính sách khoá dùng chung
 * (`decideSharedMachineKey`) từ chối — tách riêng để người vận hành biết phải xoay
 * sang mk_ (hoặc đặt MACHINE_SHARED_KEY_ALLOWED), không phải đi tìm "khoá sai".
 */
export type SocketMachineAuthMethod = "legacy" | "legacy-denied" | "mk" | "none";

export interface SocketMachineAuthResult {
  ok: boolean;
  method: SocketMachineAuthMethod;
}

/** The minimal machine shape the verifier needs (a machines row satisfies it). */
export interface SocketAuthMachine {
  id: number;
  code: string;
  apiKey: string | null;
  /** Cho luật mk_-only của decideSharedMachineKey (automation/iot). */
  machineType?: string | null;
}

/**
 * Verify a machine socket event's credential: legacy-OR-mk (see file header).
 * Decision function — the only side effect is the weak-auth usage registry the
 * shared-key decision records (rotation evidence, same as HTTP); the handlers
 * call recordSocketMachineAuthMismatch themselves so `off` mode stays untouched.
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
  // doc 81 Đợt 1B Task 9: a match is then put to the SAME shared-key decision the
  // HTTP machine router and /api/v1 use (Task 8) — MACHINE_SHARED_KEY_ALLOWED
  // (default deny) + mk_-only. No scope: presence marks the machine online and
  // writes machine_status_logs, so `read-only` does not admit it either.
  if (machine.apiKey != null && machine.apiKey === key) {
    const { decision } = decideSharedMachineKey(machine, undefined, endpoint);
    return decision === "allowed" ? { ok: true, method: "legacy" } : { ok: false, method: "legacy-denied" };
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
