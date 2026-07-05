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
 *   2. Legacy shared plaintext `machines.apiKey` — kept for backward compat
 *      behind MACHINE_SHARED_KEY_ALLOWED (default TRUE for now) with a throttled
 *      deprecation warning. Set MACHINE_SHARED_KEY_ALLOWED=false once every
 *      machine has been rotated to a scoped key.
 *   3. machineCode-only identification (existing weak path, unchanged).
 *
 * ROTATION FLOW (used by the AOI onboarding wizard, W2-D):
 *   issueMachineKey → configure the machine with the plaintext (shown ONCE) →
 *   verify traffic arrives with method="machine-key" → revoke the old key
 *   (rotateMachineKey does both) → finally clear machines.apiKey / flip the
 *   shared-key flag off.
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
import { ALL_SCOPES, scopeSatisfied, type ApiScope } from "../api/v1/scopes";

// ── flags / config ───────────────────────────────────────────────────────────

/** Legacy shared plaintext machines.apiKey accepted? Default TRUE (compat). */
export function sharedMachineKeyAllowed(): boolean {
  return process.env.MACHINE_SHARED_KEY_ALLOWED !== "false";
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

/** Throttled shared-key deprecation warnings: one per machine per 10 min. */
const sharedKeyWarnAt = new Map<string, number>();
const SHARED_KEY_WARN_MIN_MS = 10 * 60 * 1000;

function warnSharedKeyDeprecated(machineCode: string): void {
  const now = Date.now();
  const prev = sharedKeyWarnAt.get(machineCode) ?? 0;
  if (now - prev < SHARED_KEY_WARN_MIN_MS) return;
  sharedKeyWarnAt.set(machineCode, now);
  console.warn(
    `[MachineAuth] DEPRECATED shared plaintext apiKey used by machine ${machineCode}. ` +
      `Issue a per-machine scoped key (machineApi.issueKey / onboarding wizard) and set ` +
      `MACHINE_SHARED_KEY_ALLOWED=false once all machines are rotated.`,
  );
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
}): Promise<MachineAuthResult> {
  const key = (opts.headerKey ?? opts.apiKey ?? "").trim();

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

    // 2) Legacy shared plaintext machines.apiKey (backward compat, flag-gated).
    if (sharedMachineKeyAllowed()) {
      let machine: MachineRow | undefined;
      try {
        machine = await db.getMachineByApiKey(key);
      } catch {
        throw new DbUnavailableError();
      }
      if (machine) {
        warnSharedKeyDeprecated(machine.code);
        return { machine, method: "shared-key" };
      }
    }

    if (await dbPositivelyDown()) throw new DbUnavailableError();
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
  }

  // 3) machineCode-only identification (existing weak path — unchanged).
  if (opts.machineCode && opts.machineCode.trim()) {
    let machine: MachineRow | undefined;
    try {
      machine = await db.getMachineByCode(opts.machineCode.trim());
    } catch {
      throw new DbUnavailableError();
    }
    if (machine) return { machine, method: "machine-code" };
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
  sharedKeyWarnAt.clear();
}
