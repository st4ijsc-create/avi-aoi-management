/**
 * Operator/Badge master service (doc 29 §3 — W8-B, migration 0192).
 *
 * `resolveOperator(badgeCode, at)` is the ONE resolution rule for turning the
 * free varchar operatorId machines send (re-defined as BADGE CODE) into a
 * canonical users.id:
 *
 *   • only isActive rows count for the CURRENT holder, but historical (revoked)
 *     rows still resolve PAST timestamps — a badge re-issued to someone else
 *     must attribute old inspections to the old holder;
 *   • a row matches `at` when (validFrom IS NULL OR validFrom <= at) AND
 *     (validTo IS NULL OR at < validTo)  — [validFrom, validTo) half-open;
 *   • among matches, the row with the LATEST validFrom wins (NULL validFrom =
 *     open start, lowest precedence); active rows win over inactive on ties;
 *   • no match → null (NEVER a guess), and the badge is auto-registered as
 *     source='auto_seen' (userId NULL) so the admin page can queue it for
 *     mapping — but only when the code has NO rows at all (a known badge outside
 *     its window must not spawn a duplicate).
 *
 * INGEST SAFETY: resolveOperatorUserId is fail-open (any error → null, never
 * throws) and memoized for 30s per badgeCode — the hot ingest path must not add
 * a per-inspection lookup storm nor ever reject a submission over badge state.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { operatorBadges, type OperatorBadge } from "../../drizzle/schema";

export interface ResolvedOperator {
  badgeId: number;
  userId: number | null;
  displayName: string | null;
}

// ── 30s memo cache (badgeCode → rows). Ingest-hot; badge master changes rarely. ──
const CACHE_TTL_MS = 30_000;
const rowCache = new Map<string, { rows: OperatorBadge[]; at: number }>();
/** badge codes we already auto-registered this process (avoid repeat inserts). */
const autoSeenLedger = new Set<string>();

/** Test hook — clear the memo cache + auto-seen ledger. */
export function _resetBadgeCache(): void {
  rowCache.clear();
  autoSeenLedger.clear();
}

async function loadBadgeRows(badgeCode: string): Promise<OperatorBadge[]> {
  const now = Date.now();
  const cached = rowCache.get(badgeCode);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(operatorBadges).where(eq(operatorBadges.badgeCode, badgeCode));
  rowCache.set(badgeCode, { rows, at: now });
  return rows;
}

function windowCovers(row: OperatorBadge, at: Date): boolean {
  if (row.validFrom && row.validFrom.getTime() > at.getTime()) return false;
  if (row.validTo && at.getTime() >= row.validTo.getTime()) return false;
  return true;
}

/**
 * Resolve a badge code to its holder at time `at` (default now).
 * Returns null when the badge is unknown or no validity window covers `at`.
 */
export async function resolveOperator(
  badgeCode: string,
  at: Date = new Date(),
): Promise<ResolvedOperator | null> {
  const code = badgeCode.trim();
  if (!code) return null;
  const rows = await loadBadgeRows(code);
  const matches = rows
    .filter((r) => windowCovers(r, at))
    .sort((a, b) => {
      // Latest validFrom first (NULL = open start → lowest precedence)…
      const af = a.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
      const bf = b.validFrom?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (af !== bf) return bf - af;
      // …then active over inactive, then newest row.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.id - a.id;
    });
  const winner = matches[0];
  if (!winner) return null;
  return { badgeId: winner.id, userId: winner.userId ?? null, displayName: winner.displayName ?? null };
}

/**
 * Ingest-facing resolver: badge code → users.id (or null), FAIL-OPEN — never
 * throws, never rejects an inspection. Unknown codes (no rows at all) are
 * auto-registered as source='auto_seen' fire-and-forget.
 */
export async function resolveOperatorUserId(
  badgeCode: string,
  at: Date = new Date(),
): Promise<number | null> {
  try {
    const code = badgeCode.trim();
    if (!code) return null;
    const rows = await loadBadgeRows(code);
    if (rows.length === 0) {
      void autoRegisterSeenBadge(code).catch(() => undefined);
      return null;
    }
    const resolved = await resolveOperator(code, at);
    return resolved?.userId ?? null;
  } catch {
    return null; // fail-open: badge master trouble must never affect ingest
  }
}

/**
 * Register a never-seen badge code as 'auto_seen' (userId NULL) → surfaces in
 * the admin "unassigned badges" queue. Race/duplicate-safe: the partial unique
 * index (badgeCode WHERE isActive) makes concurrent inserts conflict — swallowed.
 */
async function autoRegisterSeenBadge(code: string): Promise<void> {
  if (autoSeenLedger.has(code)) return;
  autoSeenLedger.add(code);
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(operatorBadges).values({ badgeCode: code, source: "auto_seen", isActive: true });
    rowCache.delete(code); // next resolution sees the new row
  } catch {
    /* unique-race or transient — the badge either exists now or will be re-seen */
  }
}

// ── Admin CRUD (router-facing) ───────────────────────────────────────────────

export interface IssueBadgeInput {
  badgeCode: string;
  userId?: number | null;
  displayName?: string | null;
  source?: string;
  validFrom?: Date | null;
  validTo?: Date | null;
  issuedBy?: number | null;
  notes?: string | null;
}

/**
 * Issue a badge. If an ACTIVE row for the code exists it is revoked first,
 * closed at the cutover instant (new row's validFrom, default now) — this IS
 * the re-issue path: windows partition as old [*, cutover) / new [cutover, *),
 * so the old row keeps resolving historical timestamps and the new row owns
 * the future. The new row ALWAYS gets an explicit validFrom = cutover.
 */
export async function issueBadge(input: IssueBadgeInput): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const code = input.badgeCode.trim();
  if (!code) throw new Error("badgeCode must be non-empty");
  const cutover = input.validFrom ?? new Date();
  const id = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(operatorBadges)
      .where(eq(operatorBadges.badgeCode, code));
    const active = existing.find((r) => r.isActive);
    if (active) {
      const closeAt =
        active.validTo && active.validTo.getTime() < cutover.getTime() ? active.validTo : cutover;
      await tx
        .update(operatorBadges)
        .set({ isActive: false, validTo: closeAt, updatedAt: new Date() })
        .where(eq(operatorBadges.id, active.id));
    }
    const [row] = await tx
      .insert(operatorBadges)
      .values({
        badgeCode: code,
        userId: input.userId ?? null,
        displayName: input.displayName ?? null,
        source: input.source ?? "manual",
        validFrom: cutover,
        validTo: input.validTo ?? null,
        issuedBy: input.issuedBy ?? null,
        notes: input.notes ?? null,
        isActive: true,
      })
      .returning({ id: operatorBadges.id });
    return row.id;
  });
  rowCache.delete(code);
  return id;
}

/** Revoke a badge row (isActive=false; validTo defaults to now). */
export async function revokeBadge(id: number, validTo?: Date): Promise<OperatorBadge | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .update(operatorBadges)
    .set({ isActive: false, validTo: validTo ?? new Date(), updatedAt: new Date() })
    .where(eq(operatorBadges.id, id))
    .returning();
  if (row) rowCache.delete(row.badgeCode);
  return row ?? null;
}

/** Patch a badge row (assign user / rename / window edit). */
export async function updateBadge(
  id: number,
  patch: Partial<Omit<IssueBadgeInput, "badgeCode">>,
): Promise<OperatorBadge | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.userId !== undefined) set.userId = patch.userId;
  if (patch.displayName !== undefined) set.displayName = patch.displayName;
  if (patch.source !== undefined) set.source = patch.source;
  if (patch.validFrom !== undefined) set.validFrom = patch.validFrom;
  if (patch.validTo !== undefined) set.validTo = patch.validTo;
  if (patch.issuedBy !== undefined) set.issuedBy = patch.issuedBy;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [row] = await db.update(operatorBadges).set(set).where(eq(operatorBadges.id, id)).returning();
  if (row) rowCache.delete(row.badgeCode);
  return row ?? null;
}
