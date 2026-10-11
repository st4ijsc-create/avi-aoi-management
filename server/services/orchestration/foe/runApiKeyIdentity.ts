/**
 * doc 81 Đợt 9 task R1/R2 (owner decision 2026-10-12, option A) — the API-KEY IDENTITY behind an orchestration run.
 *
 * Migration 0369 adds `api_keys."holderUserId"` (who the key is ISSUED TO), the append-only `api_key_holder_changes`
 * history (trigger-written) and `orchestration_runs."startedViaApiKeyId"` (which key started the run, write-once).
 *
 * ★ These columns are deliberately NOT on the main drizzle objects (`apiKeys`, `orchestrationRuns`) — 0368 lesson:
 *   `select().from(apiKeys)` is the API v1 AUTH read and `select().from(orchestrationRuns)` is on the ABORT / STOP paths;
 *   with the columns on those objects, code running before 0369 is applied would fail every one of them (42703). They are
 *   read and written ONLY through the narrow projections below, so a missing 0369 means exactly: an API-started run cannot
 *   be identified ⇒ its non-STOP OT/robot commands are refused (apiRun) and keys show no holder. Every other path unchanged.
 *
 * Group S (Đợt 9, mig 0370) — new orchestration_runs columns should follow the same rule (narrow projection, never on the
 * full-row object), for the same reason.
 */
import { eq, inArray } from "drizzle-orm";
import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Narrow projection of orchestration_runs: the API key that started the run (mig 0369; write-once trigger). */
export const runApiKeyCols = pgTable("orchestration_runs", {
  id: integer("id").notNull(),
  startedViaApiKeyId: integer("startedViaApiKeyId"),
});

/** Narrow projection of api_keys: identity columns only (never keyHash). `holderUserId` = mig 0369. */
export const apiKeyIdentityCols = pgTable("api_keys", {
  id: integer("id").notNull(),
  name: varchar("name", { length: 255 }),
  keyPrefix: varchar("keyPrefix", { length: 32 }),
  isActive: boolean("isActive"),
  createdBy: integer("createdBy"),
  holderUserId: integer("holderUserId"),
});

/** mig 0369 — append-only history of api_keys.holderUserId (written by the trigger trg_api_keys_holder_history). */
export const apiKeyHolderChanges = pgTable("api_key_holder_changes", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("apiKeyId").notNull(),
  fromUserId: integer("fromUserId"),
  toUserId: integer("toUserId"),
  changedBy: integer("changedBy"),
  reason: text("reason"),
  changedAt: timestamp("changedAt", { withTimezone: true }).defaultNow().notNull(),
});

type DbLike = { select: (...a: any[]) => any };

export const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** The key that started a run (null = none recorded). THROWS on a DB error (incl. 0369 missing) — callers fail closed. */
export async function readRunApiKeyId(db: DbLike, runId: number): Promise<number | null> {
  const [row] = await db.select({ id: runApiKeyCols.id, startedViaApiKeyId: runApiKeyCols.startedViaApiKeyId }).from(runApiKeyCols).where(eq(runApiKeyCols.id, runId)).limit(1);
  const v = (row as { startedViaApiKeyId?: unknown } | undefined)?.startedViaApiKeyId;
  return posInt(v) ? v : null;
}

export interface ApiKeyParties {
  keyId: number;
  name: string | null;
  keyPrefix: string | null;
  isActive: boolean | null;
  creator: number | null;
  /** The user the key is issued to NOW (null = no holder). */
  holder: number | null;
  /** Every user the key was ever issued to (api_key_holder_changes, from + to), the current holder included. */
  everHolders: number[];
}

/** The identity rows of a key; null = no such key. THROWS on a DB error — callers fail closed. */
export async function readApiKeyParties(db: DbLike, keyId: number): Promise<ApiKeyParties | null> {
  const [k] = await db
    .select({
      id: apiKeyIdentityCols.id,
      name: apiKeyIdentityCols.name,
      keyPrefix: apiKeyIdentityCols.keyPrefix,
      isActive: apiKeyIdentityCols.isActive,
      createdBy: apiKeyIdentityCols.createdBy,
      holderUserId: apiKeyIdentityCols.holderUserId,
    })
    .from(apiKeyIdentityCols)
    .where(eq(apiKeyIdentityCols.id, keyId))
    .limit(1);
  if (!k || (k as { id?: unknown }).id !== keyId) return null;
  const hist = (await db
    .select({ apiKeyId: apiKeyHolderChanges.apiKeyId, fromUserId: apiKeyHolderChanges.fromUserId, toUserId: apiKeyHolderChanges.toUserId })
    .from(apiKeyHolderChanges)
    .where(eq(apiKeyHolderChanges.apiKeyId, keyId))) as Array<{ apiKeyId?: unknown; fromUserId?: unknown; toUserId?: unknown }>;
  const row = k as { name?: string | null; keyPrefix?: string | null; isActive?: boolean | null; createdBy?: unknown; holderUserId?: unknown };
  const holder = posInt(row.holderUserId) ? row.holderUserId : null;
  const ever = new Set<number>();
  if (holder) ever.add(holder);
  for (const h of hist) {
    if (h.apiKeyId !== keyId) continue; // defensive: a fake / mis-filtered read never widens another key's set
    if (posInt(h.fromUserId)) ever.add(h.fromUserId);
    if (posInt(h.toUserId)) ever.add(h.toUserId);
  }
  return {
    keyId,
    name: row.name ?? null,
    keyPrefix: row.keyPrefix ?? null,
    isActive: row.isActive ?? null,
    creator: posInt(row.createdBy) ? row.createdBy : null,
    holder,
    everHolders: [...ever].sort((a, b) => a - b),
  };
}

/** Holders of several keys at once (the API keys list). Missing column / DB error ⇒ empty map (shown as "not recorded"). */
export async function readHoldersOfKeys(db: DbLike, keyIds: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  if (keyIds.length === 0) return out;
  try {
    const rows = (await db
      .select({ id: apiKeyIdentityCols.id, holderUserId: apiKeyIdentityCols.holderUserId })
      .from(apiKeyIdentityCols)
      .where(inArray(apiKeyIdentityCols.id, keyIds))) as Array<{ id: number; holderUserId: unknown }>;
    for (const r of rows) out.set(r.id, posInt(r.holderUserId) ? r.holderUserId : null);
  } catch {
    /* 0369 not applied / DB error — the caller shows "not recorded" */
  }
  return out;
}

