/**
 * Doc 27 Đợt 2 / W2-C — PER-MACHINE CREDENTIALS + INGEST RATE-LIMIT (gaps C7 P1,
 * M4-throttle P1; R12 lives in mqttService).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Today every machine endpoint authenticates with the SHARED plaintext
 * `machines.apiKey` column (or a bare machineCode). This service adds a proper
 * per-machine credential on top of the EXISTING `api_keys` table from migration
 * 0126 (extended by 0178 with `machineId` + `revokedAt`) instead of a duplicate
 * table — same SHA-256-hash-at-rest storage, same scope vocabulary, same auth
 * algorithm the /api/v1 middleware already verifies against.
 *
 * Resolution order for a presented key:
 *   1. `api_keys` row (hash match) WITH a machineId → machine-scoped key:
 *      revoked/expired → UNAUTHORIZED (no fallthrough — a revoked key must die),
 *      scope check, throttled lastUsedAt bump.
 *   2. Legacy shared plaintext `machines.apiKey` — WEAK path, gated by
 *      MACHINE_SHARED_KEY_ALLOWED (default `allow` for backward compat).
 *   3. machineCode-only identification — WEAK path (NO secret at all), gated by
 *      MACHINE_CODE_ONLY_ALLOWED (default `allow` for backward compat).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DOC 51 P0 / QĐ#1 — CONTROLLED MIGRATION OFF THE WEAK PATHS
 *
 * Both weak paths carry the same doc-51-R1 risk: anyone on the LAN who learns a
 * machineCode (or scrapes the plaintext shared key) can forge a machine and inject
 * inspection/NG data. The owner approved CONTROLLED migration — NOT a hard flip
 * that kills machines mid-shift. So each weak path is a TRI-STATE policy flag:
 *
 *   allow      (default) — accepted everywhere, telemetry recorded on every use.
 *   read-only            — accepted for READ scopes (equipment:read) only; every
 *                          WRITE (ingest:write / edge:sync / unknown) is denied.
 *                          The graduated middle step: forged ingest stops NOW while
 *                          un-rotated machines keep polling config and surface as
 *                          loud, diagnosable write-401s instead of a blackout.
 *   deny                 — accepted nowhere (the pre-existing `false` semantics,
 *                          preserved bit-for-bit so a deployment already shipping
 *                          MACHINE_SHARED_KEY_ALLOWED=false is NEVER weakened).
 *
 * WARN-THEN-DENY: a weak path can only be flipped safely if ops knows WHICH
 * machines still use it. Every weak-path attempt (allowed AND denied) increments
 * an in-process counter keyed machine+method+endpoint (getWeakAuthUsage(), exact,
 * unthrottled) and emits a Prometheus security event; the human-readable pino line
 * stays throttled so a chatty machine cannot flood the log. Denied attempts are
 * recorded TOO — that is the rollback signal after a flip.
 *
 * Fleet-wide, cross-restart visibility comes from `scripts/machine-key-rotation-report.mjs`
 * (DB-only inference: mk_ key present + lastUsedAt vs machines.lastHeartbeat).
 *
 * ROTATION FLOW (runbook: docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md):
 *   report → issueMachineKey → configure the machine with the plaintext (shown
 *   ONCE) via `Authorization: Bearer` / `X-API-Key` → verify traffic arrives with
 *   method="machine-key" AND getWeakAuthUsage() is clean → revoke the old key
 *   (rotateMachineKey does both) → flip the flags to `deny` in production →
 *   finally clear machines.apiKey.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * DB-health awareness: when the machine cannot be resolved AND the DB is
 * positively unreachable, DbUnavailableError is thrown instead of UNAUTHORIZED
 * so the ingest durability layer (inspectionStoreForward) can buffer instead of
 * bouncing the machine.
 *
 * Rate limit is in-memory fixed-window per machine key (per key id when a
 * scoped key is used, else per machine id). NOTE (W4-D / Đợt 4 gap B6 outcome):
 * the HTTP-level express limiters DID move to a Redis-backed store, but this
 * per-machine ingest limiter deliberately stayed instance-local — it has no
 * pluggable store (bare Map) and, unlike the NAT'd browser traffic, machine
 * ingest terminates on one instance today. Revisit only when ingest itself is
 * load-balanced across instances.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { apiKeys } from "../../drizzle/schema";
import { logger } from "../logger";
import { API_SCOPES, ALL_SCOPES, scopeSatisfied, type ApiScope } from "../api/v1/scopes";

// ── flags / config ───────────────────────────────────────────────────────────

/**
 * Doc 51 P0 (QĐ#1) — how far a WEAK (non-`mk_`) machine credential is trusted.
 * See the header block: `allow` (compat default) → `read-only` (graduated) →
 * `deny` (rotation complete).
 */
export type WeakAuthPolicy = "allow" | "read-only" | "deny";

/**
 * Parse a weak-auth flag. Accepts the LEGACY boolean vocabulary (`true`/`false`)
 * so pre-doc-51 .env files keep their exact meaning, plus the new `read-only`.
 *
 * Unrecognised values fall back to the flag's DEFAULT and log ONCE at error level
 * rather than throwing or failing closed: throwing/denying on a typo would kill a
 * running line, which is exactly what QĐ#1 forbids. The fallback is never MORE
 * permissive than leaving the flag unset, and the loud log + the rotation report
 * are how a typo gets caught. Verify with telemetry — never assume a flip landed.
 */
function parseWeakAuthPolicy(name: string, raw: string | undefined, fallback: WeakAuthPolicy): WeakAuthPolicy {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return fallback;
  if (v === "false" || v === "0" || v === "off" || v === "no" || v === "deny") return "deny";
  if (v === "true" || v === "1" || v === "on" || v === "yes" || v === "allow") return "allow";
  if (v === "read-only" || v === "readonly" || v === "read_only") return "read-only";
  warnBadPolicyValueOnce(name, v, fallback);
  return fallback;
}

const badPolicyValueWarned = new Set<string>();
function warnBadPolicyValueOnce(name: string, value: string, fallback: WeakAuthPolicy): void {
  if (badPolicyValueWarned.has(name)) return;
  badPolicyValueWarned.add(name);
  logger.error(
    { flag: name, value, fallback, doc: "51-P0" },
    `[MachineAuth] ${name}="${value}" không hợp lệ — chỉ nhận allow|read-only|deny (hoặc true|false). ` +
      `Đang dùng mặc định "${fallback}". SỬA .env rồi restart: giá trị sai KHÔNG siết được đường yếu.`,
  );
}

/**
 * Legacy shared plaintext `machines.apiKey` policy. Default `allow` (compat).
 * `MACHINE_SHARED_KEY_ALLOWED=false` keeps its original meaning: deny everywhere.
 */
export function sharedMachineKeyPolicy(): WeakAuthPolicy {
  return parseWeakAuthPolicy("MACHINE_SHARED_KEY_ALLOWED", process.env.MACHINE_SHARED_KEY_ALLOWED, "allow");
}

/**
 * machineCode-only (NO secret) policy. Default `allow` (compat — doc 51 §5.6:
 * this is still the primary DOCUMENTED method, so production flips it, not dev).
 */
export function machineCodeOnlyPolicy(): WeakAuthPolicy {
  return parseWeakAuthPolicy("MACHINE_CODE_ONLY_ALLOWED", process.env.MACHINE_CODE_ONLY_ALLOWED, "allow");
}

/**
 * BACK-COMPAT shim for callers/tests that only ask "is the shared key accepted at
 * all?". TRUE for both `allow` and `read-only` — use sharedMachineKeyPolicy() when
 * the read/write distinction matters.
 */
export function sharedMachineKeyAllowed(): boolean {
  return sharedMachineKeyPolicy() !== "deny";
}

/**
 * Scopes a WEAK credential may still satisfy under `read-only`. Deliberately a
 * tiny allowlist: everything else (ingest:write, edge:sync, an unknown scope, or
 * NO scope at all) counts as a WRITE and is denied — fail-closed, so a caller that
 * forgets to declare its scope cannot silently keep write access.
 */
const WEAK_AUTH_READ_SCOPES: ReadonlySet<string> = new Set<string>([API_SCOPES.EQUIPMENT_READ]);

function weakAuthDecision(policy: WeakAuthPolicy, scope?: ApiScope): "allowed" | "denied" {
  if (policy === "allow") return "allowed";
  if (policy === "deny") return "denied";
  return scope && WEAK_AUTH_READ_SCOPES.has(scope) ? "allowed" : "denied";
}

/** Ingest requests allowed per machine key per minute. 0 disables. */
export function machineIngestRateLimitPerMin(): number {
  const n = parseInt(process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN || "600", 10);
  return Number.isFinite(n) && n >= 0 ? n : 600;
}

// ── hashing (MUST match server/api/v1/auth.ts so one table serves both) ──────

/** SHA-256 hex of a plaintext key — the exact algorithm api_keys.keyHash uses. */
export function hashMachineKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Generate a strong machine key. Format `mk_<48 hex>` (distinct from ak_ admin keys). */
export function generateMachineKey(): { plaintext: string; prefix: string } {
  const secret = randomBytes(24).toString("hex");
  return { plaintext: `mk_${secret}`, prefix: `mk_${secret.slice(0, 6)}` };
}

/** Default scopes a freshly issued machine key gets (covers the machine router). */
export const MACHINE_KEY_DEFAULT_SCOPES: ApiScope[] = [
  "ingest:write",
  "equipment:read",
  "edge:sync",
];

// ── errors ────────────────────────────────────────────────────────────────────

/** The DB is positively unreachable — callers with a WAL should buffer, not 401. */
export class DbUnavailableError extends Error {
  constructor(message = "Database unavailable") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

// ── auth ──────────────────────────────────────────────────────────────────────

type MachineRow = NonNullable<Awaited<ReturnType<typeof db.getMachineByApiKey>>>;

export interface MachineAuthResult {
  machine: MachineRow;
  method: "machine-key" | "shared-key" | "machine-code";
  keyId?: number;
  scopes?: string[];
}

/** Throttled lastUsedAt writes: at most one UPDATE per key per 60s. */
const lastUsedWriteAt = new Map<number, number>();
const LAST_USED_WRITE_MIN_MS = 60_000;

function touchLastUsed(keyId: number): void {
  const now = Date.now();
  const prev = lastUsedWriteAt.get(keyId) ?? 0;
  if (now - prev < LAST_USED_WRITE_MIN_MS) return;
  lastUsedWriteAt.set(keyId, now);
  void (async () => {
    try {
      const d = await db.getDb();
      if (!d) return;
      await d.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
    } catch {
      /* best-effort — never blocks auth */
    }
  })();
}

// ── weak-auth telemetry (doc 51 P0 / QĐ#1 — WARN-THEN-DENY prerequisite) ─────
//
// The COUNTER is the product here, not the log line: ops must be able to answer
// "which machines still use a weak path, on which endpoint?" BEFORE flipping a
// flag, and "what broke?" straight after. The old throttled console.warn could
// not answer either (throttling DROPS the evidence, and a warn is not queryable).
//
// In-process + exact + unthrottled. Cleared on restart by design — the durable,
// fleet-wide view is scripts/machine-key-rotation-report.mjs (DB-only). Bounded
// so a hostile scanner cannot grow it without limit.

/** One machine × method × endpoint × outcome bucket. */
export interface WeakAuthUsageRow {
  machineId: number;
  machineCode: string;
  /** Which weak path: legacy shared plaintext key, or bare machineCode (no secret). */
  method: "shared-key" | "machine-code";
  /** Caller-supplied label, else the required scope, else "unknown". */
  endpoint: string;
  /** Was it let through (flag still open) or refused (flag already flipped)? */
  outcome: "allowed" | "denied";
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const weakAuthUsage = new Map<string, WeakAuthUsageRow>();
/** Bound: ~real fleets are 10²; 2000 buckets is unreachable in normal operation. */
const WEAK_AUTH_USAGE_MAX = 2000;
let weakAuthUsageOverflow = 0;

/** Throttled HUMAN log: one line per machine+method+endpoint+outcome per 10 min. */
const weakAuthLogAt = new Map<string, number>();
const WEAK_AUTH_LOG_MIN_MS = 10 * 60 * 1000;

/** Lazily-bridged Prometheus security counter — never a hard dep of auth. */
let incSecurityEventFn: ((type: string, mode: string) => void) | null = null;
let metricsBridgeRequested = false;

function emitWeakAuthMetric(method: string, outcome: string): void {
  if (incSecurityEventFn) {
    try {
      // Reuses the EXISTING avi_aoi_security_events_total counter (labels type/mode)
      // — no change to _core/metrics.ts. Per-machine detail lives in the registry
      // above; a machineId label would blow up Prometheus cardinality.
      incSecurityEventFn(`machine_weak_auth_${outcome}`, method);
    } catch {
      /* metrics must never break auth */
    }
    return;
  }
  if (metricsBridgeRequested) return;
  metricsBridgeRequested = true;
  // Dynamic: keeps _core/metrics (and its prom-client / SLO chain) off the auth
  // module graph. Fire-and-forget — the first weak hit may miss the metric; the
  // in-memory registry is exact regardless, so nothing is lost.
  void import("../_core/metrics")
    .then((m) => {
      incSecurityEventFn = m.incSecurityEvent;
    })
    .catch(() => {
      /* metrics unavailable → registry + log remain authoritative */
    });
}

/**
 * Record ONE weak-path attempt. Called on BOTH outcomes — a denied attempt after
 * a flag flip is precisely the signal that says "roll back / go rotate that machine".
 */
function recordWeakAuthUse(opts: {
  machineId: number;
  machineCode: string;
  method: "shared-key" | "machine-code";
  endpoint: string;
  outcome: "allowed" | "denied";
}): void {
  const { machineId, machineCode, method, endpoint, outcome } = opts;
  const key = `${machineId}|${method}|${endpoint}|${outcome}`;
  const nowIso = new Date().toISOString();
  const existing = weakAuthUsage.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = nowIso;
  } else if (weakAuthUsage.size < WEAK_AUTH_USAGE_MAX) {
    weakAuthUsage.set(key, {
      machineId,
      machineCode,
      method,
      endpoint,
      outcome,
      count: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
    });
  } else {
    // Full: keep the established buckets (the rotation signal) rather than evict
    // them for a flood of new ones. Overflow is surfaced, not swallowed.
    weakAuthUsageOverflow += 1;
  }

  emitWeakAuthMetric(method, outcome);

  const now = Date.now();
  const prevLog = weakAuthLogAt.get(key) ?? 0;
  if (now - prevLog >= WEAK_AUTH_LOG_MIN_MS) {
    weakAuthLogAt.set(key, now);
    if (weakAuthLogAt.size > WEAK_AUTH_USAGE_MAX) weakAuthLogAt.clear(); // bound
    const meta = { machineId, machineCode, method, endpoint, outcome, doc: "51-P0" };
    if (outcome === "denied") {
      logger.warn(
        meta,
        `[MachineAuth] TỪ CHỐI đường yếu "${method}" của máy ${machineCode} tại ${endpoint} — ` +
          `máy này CHƯA rotate sang khoá mk_. Cấp khoá (machineApi.issueKey) hoặc nới cờ để lùi. ` +
          `Runbook: docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md`,
      );
    } else {
      logger.warn(
        meta,
        `[MachineAuth] Đường yếu "${method}" (DEPRECATED) đang được máy ${machineCode} dùng tại ${endpoint}. ` +
          `Cấp khoá mk_ per-máy rồi siết cờ về deny. Xem getWeakAuthUsage() / ` +
          `node scripts/machine-key-rotation-report.mjs`,
      );
    }
  }
}

/**
 * Snapshot of every weak-auth bucket seen since boot (newest activity first).
 * Read-only copy — mutating it cannot corrupt the registry.
 *
 * NOTE (coordinator): not surfaced over HTTP yet. A read-only admin endpoint (or a
 * /metrics gauge) is the natural follow-up — both touch files outside this zone.
 */
export function getWeakAuthUsage(): WeakAuthUsageRow[] {
  return [...weakAuthUsage.values()]
    .map((r) => ({ ...r }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Attempts dropped because the registry hit WEAK_AUTH_USAGE_MAX (0 = full fidelity). */
export function getWeakAuthUsageOverflow(): number {
  return weakAuthUsageOverflow;
}

/**
 * Is the DB positively down? getDb() returning null is the repo-wide "not
 * connected" signal. A getDb that THROWS (e.g. a partial vi.mock in unit tests)
 * is treated as "unknown → assume reachable" so auth still fails closed.
 */
async function dbPositivelyDown(): Promise<boolean> {
  try {
    const d = await db.getDb();
    return !d;
  } catch {
    return false;
  }
}

/**
 * Authenticate a machine request. Accepts (in priority order) a key from the
 * Authorization header, the legacy `apiKey` input field, or a `machineCode`.
 * Throws TRPCError UNAUTHORIZED/FORBIDDEN, or DbUnavailableError when the
 * machine could not be resolved BECAUSE the DB is down.
 */
export async function authenticateMachine(opts: {
  apiKey?: string | null;
  machineCode?: string | null;
  headerKey?: string | null;
  scope?: ApiScope;
  /**
   * Doc 51 P0 — label for weak-auth telemetry (e.g. "submitInspection"). Optional
   * and additive: callers that omit it fall back to the required scope, so no
   * existing call site breaks. Pass it from the machine router to get per-endpoint
   * rotation evidence instead of per-scope.
   */
  endpoint?: string;
}): Promise<MachineAuthResult> {
  const key = (opts.headerKey ?? opts.apiKey ?? "").trim();
  const endpoint = opts.endpoint?.trim() || opts.scope || "unknown";

  if (key) {
    // 1) Machine-scoped key in api_keys (hash-at-rest, migration 0126+0178).
    let row: typeof apiKeys.$inferSelect | undefined;
    try {
      const d = await db.getDb();
      if (d) {
        const rows = await d
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.keyHash, hashMachineKey(key)))
          .limit(1);
        row = rows[0];
      }
    } catch {
      // api_keys lookup unavailable (mocked db barrel in unit tests, table
      // missing, or DB down) → fall through to the legacy path, which carries
      // its own DB-health handling.
      row = undefined;
    }

    if (row) {
      if (row.machineId == null) {
        // A general /api/v1 key is not a machine credential on this router.
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
      }
      if (!row.isActive || row.revokedAt) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "API key revoked" });
      }
      if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "API key expired" });
      }
      const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
      if (opts.scope && !scopeSatisfied(scopes, opts.scope)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This machine key lacks the required scope "${opts.scope}"`,
        });
      }
      let machine: MachineRow | undefined;
      try {
        machine = await db.getMachineById(row.machineId);
      } catch {
        throw new DbUnavailableError();
      }
      if (!machine || machine.isActive === false) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
      }
      touchLastUsed(row.id);
      return { machine, method: "machine-key", keyId: row.id, scopes };
    }

    // 2) Legacy shared plaintext machines.apiKey — WEAK path (doc 51 R1).
    //    The lookup runs even when the policy will DENY: resolving the machine is
    //    what lets telemetry name it, and "machine X denied on submitInspection"
    //    is the whole point of warn-then-deny (it drives rotate-vs-rollback). The
    //    extra query only resolves for a REAL shared key, and a bogus key costs
    //    exactly what it costs today on the allow path.
    const sharedPolicy = sharedMachineKeyPolicy();
    let sharedMachine: MachineRow | undefined;
    try {
      sharedMachine = await db.getMachineByApiKey(key);
    } catch {
      // Only the allow path can distinguish "DB down" from "bad key"; when the
      // policy denies we must not turn a deny into a buffered 503, so fall
      // through to the shared dbPositivelyDown()/UNAUTHORIZED handling below.
      if (sharedPolicy === "allow") throw new DbUnavailableError();
      sharedMachine = undefined;
    }
    if (sharedMachine) {
      const decision = weakAuthDecision(sharedPolicy, opts.scope);
      recordWeakAuthUse({
        machineId: sharedMachine.id,
        machineCode: sharedMachine.code,
        method: "shared-key",
        endpoint,
        outcome: decision,
      });
      if (decision === "allowed") return { machine: sharedMachine, method: "shared-key" };
      // Explicit, diagnosable message. It does reveal "this key WAS a valid shared
      // key" to whoever already holds that key — accepted: they cannot use it for
      // anything, and a vendor tech reading "Invalid API key" would otherwise hunt
      // a key that is not the problem. Doc 52 §5 documents the trade-off.
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          `Shared machine apiKey authentication is disabled for "${opts.scope ?? "this operation"}" on this server. ` +
          `Configure machine ${sharedMachine.code} with its per-machine key (mk_...) sent as ` +
          `"Authorization: Bearer <key>" or "X-API-Key: <key>".`,
      });
    }

    if (await dbPositivelyDown()) throw new DbUnavailableError();
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
  }

  // 3) machineCode-only identification — WEAK path, NO secret whatsoever (doc 51 R1).
  if (opts.machineCode && opts.machineCode.trim()) {
    const codePolicy = machineCodeOnlyPolicy();
    let machine: MachineRow | undefined;
    try {
      machine = await db.getMachineByCode(opts.machineCode.trim());
    } catch {
      if (codePolicy === "allow") throw new DbUnavailableError();
      machine = undefined;
    }
    if (machine) {
      const decision = weakAuthDecision(codePolicy, opts.scope);
      recordWeakAuthUse({
        machineId: machine.id,
        machineCode: machine.code,
        method: "machine-code",
        endpoint,
        outcome: decision,
      });
      if (decision === "allowed") return { machine, method: "machine-code" };
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          `machineCode-only authentication is disabled for "${opts.scope ?? "this operation"}" on this server. ` +
          `Configure machine ${machine.code} with its per-machine key (mk_...) sent as ` +
          `"Authorization: Bearer <key>" or "X-API-Key: <key>".`,
      });
    }
    if (await dbPositivelyDown()) throw new DbUnavailableError();
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid machine code" });
  }

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "Either apiKey or machineCode must be provided",
  });
}

// ── ingest rate limit (in-memory fixed window; Redis move = Đợt 4 / B6) ──────

const rateWindows = new Map<string, { start: number; count: number }>();
const RATE_WINDOW_MS = 60_000;

/**
 * Enforce the per-machine-key ingest rate limit. Keyed by scoped-key id when
 * one was used, else by machine id (shared key / machineCode). Throws
 * TOO_MANY_REQUESTS above the limit. 0 → disabled.
 */
export function enforceMachineIngestRateLimit(auth: {
  machine: { id: number; code: string };
  keyId?: number;
}): void {
  const limit = machineIngestRateLimitPerMin();
  if (limit <= 0) return;
  const bucket = auth.keyId != null ? `key:${auth.keyId}` : `machine:${auth.machine.id}`;
  const now = Date.now();
  const win = rateWindows.get(bucket);
  if (!win || now - win.start >= RATE_WINDOW_MS) {
    rateWindows.set(bucket, { start: now, count: 1 });
    // opportunistic GC so the map stays bounded
    if (rateWindows.size > 10_000) {
      for (const [k, v] of rateWindows) {
        if (now - v.start >= RATE_WINDOW_MS) rateWindows.delete(k);
      }
    }
    return;
  }
  win.count += 1;
  if (win.count > limit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Ingest rate limit exceeded for machine ${auth.machine.code} (${limit}/min)`,
    });
  }
}

// ── key issuance / rotation / revocation (service API for W2-D's wizard) ─────

const NAMESPACES = new Set(ALL_SCOPES.map((s) => s.split(":")[0]));

function isValidScopeGrant(s: string): boolean {
  if (s === "*") return true;
  if ((ALL_SCOPES as string[]).includes(s)) return true;
  if (s.endsWith(":*")) return NAMESPACES.has(s.slice(0, -2));
  return false;
}

async function requireDb() {
  const d = await db.getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

/** SAFE projection — NEVER exposes keyHash or plaintext. */
export function publicMachineKeyRow(r: typeof apiKeys.$inferSelect) {
  return {
    id: r.id,
    machineId: r.machineId,
    name: r.name,
    description: r.description,
    keyPrefix: r.keyPrefix,
    scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
    isActive: r.isActive,
    revokedAt: r.revokedAt,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export type PublicMachineKeyRow = ReturnType<typeof publicMachineKeyRow>;

/**
 * Mint a per-machine scoped key. The PLAINTEXT is returned EXACTLY ONCE and
 * never stored — only the SHA-256 hash is persisted (same as apiKeyRouter).
 */
export async function issueMachineKey(opts: {
  machineId: number;
  name?: string;
  scopes?: string[];
  expiresAt?: Date | null;
  createdBy?: number | null;
}): Promise<PublicMachineKeyRow & { plaintextKey: string }> {
  const d = await requireDb();
  const machine = await db.getMachineById(opts.machineId);
  if (!machine) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Machine ${opts.machineId} not found` });
  }
  const scopes = opts.scopes && opts.scopes.length > 0 ? opts.scopes : [...MACHINE_KEY_DEFAULT_SCOPES];
  if (!scopes.every(isValidScopeGrant)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more scopes are not in the published scope vocabulary" });
  }
  const { plaintext, prefix } = generateMachineKey();
  const [row] = await d
    .insert(apiKeys)
    .values({
      name: opts.name?.trim() || `machine:${machine.code}`,
      description: `Per-machine credential for ${machine.code} (${machine.name})`,
      keyHash: hashMachineKey(plaintext),
      keyPrefix: prefix,
      scopes,
      isActive: true,
      expiresAt: opts.expiresAt ?? null,
      createdBy: opts.createdBy ?? null,
      machineId: machine.id,
    })
    .returning();
  return { ...publicMachineKeyRow(row), plaintextKey: plaintext };
}

/** List a machine's keys (newest first) — SAFE shape only. */
export async function listMachineKeys(machineId: number): Promise<PublicMachineKeyRow[]> {
  const d = await requireDb();
  const rows = await d
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.machineId, machineId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(publicMachineKeyRow);
}

/** Revoke a machine key: isActive=false + revokedAt stamp (auth denies both). */
export async function revokeMachineKey(keyId: number): Promise<PublicMachineKeyRow> {
  const d = await requireDb();
  const [row] = await d
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, keyId))
    .returning();
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `API key ${keyId} not found` });
  return publicMachineKeyRow(row);
}

/**
 * Rotate: revoke the given key and mint a replacement for the same machine
 * with the same scopes/expiry. Returns the NEW plaintext exactly once.
 */
export async function rotateMachineKey(
  keyId: number,
  createdBy?: number | null,
): Promise<PublicMachineKeyRow & { plaintextKey: string }> {
  const d = await requireDb();
  const [existing] = await d.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
  if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `API key ${keyId} not found` });
  if (existing.machineId == null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `API key ${keyId} is not a machine key` });
  }
  await revokeMachineKey(keyId);
  return issueMachineKey({
    machineId: existing.machineId,
    name: existing.name,
    scopes: Array.isArray(existing.scopes) ? (existing.scopes as string[]) : undefined,
    expiresAt: existing.expiresAt ?? null,
    createdBy: createdBy ?? null,
  });
}

// ── test helpers ──────────────────────────────────────────────────────────────

export function _resetMachineAuthState(): void {
  rateWindows.clear();
  lastUsedWriteAt.clear();
  weakAuthUsage.clear();
  weakAuthLogAt.clear();
  weakAuthUsageOverflow = 0;
  badPolicyValueWarned.clear();
}
