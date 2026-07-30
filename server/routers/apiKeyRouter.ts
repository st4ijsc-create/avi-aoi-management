/**
 * Factory Control Plane — SCOPED API-KEY management router (key "apiKey").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Admin CRUD over the `api_keys` table that backs the Unified Machine API
 * (/api/v1). Lets an admin MINT a least-privilege key, edit its scopes/expiry,
 * enable/disable (revoke) and delete it.
 *
 * SECURITY (non-negotiable):
 *   • The plaintext key is generated server-side, shown ONCE in the `create`
 *     response, and NEVER stored or returned again. We persist only the SHA-256
 *     hash (REUSING server/api/v1/auth.ts hashApiKey — the SAME algorithm the auth
 *     middleware verifies against) + a short non-secret prefix for display.
 *   • `list` / `update` NEVER return keyHash or any plaintext.
 *
 * RBAC (module-level): admin_system / admin_users. Reads → canView; writes →
 * canCreate (create) / canEdit (update, revoke) / canDelete (delete). Fail-safe:
 * a missing DB throws a clean INTERNAL_SERVER_ERROR, never a silent grant.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { apiKeys } from "../../drizzle/schema";
import { hashApiKey } from "../api/v1/auth";
import { ALL_SCOPES, SCOPE_DESCRIPTIONS } from "../api/v1/scopes";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Validate a scope grant: each must be a known scope, a "<ns>:*" wildcard, or "*". */
const NAMESPACES = new Set(ALL_SCOPES.map((s) => s.split(":")[0]));
function isValidScopeGrant(s: string): boolean {
  if (s === "*") return true;
  if ((ALL_SCOPES as string[]).includes(s)) return true;
  if (s.endsWith(":*")) return NAMESPACES.has(s.slice(0, -2));
  return false;
}
const scopeSchema = z
  .array(z.string().min(1).max(64))
  .min(1, "At least one scope is required")
  .refine((arr) => arr.every(isValidScopeGrant), {
    message: "One or more scopes are not in the published scope vocabulary",
  });

/** Generate a strong random key + its display prefix. Format: `ak_<48 hex chars>`. */
function generateKey(): { plaintext: string; prefix: string } {
  const secret = randomBytes(24).toString("hex"); // 48 hex chars
  const plaintext = `ak_${secret}`;
  const prefix = `ak_${secret.slice(0, 6)}`; // non-secret, for display/identification
  return { plaintext, prefix };
}

/** Project a row to the SAFE shape (NEVER exposes keyHash). */
function publicRow(r: typeof apiKeys.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    keyPrefix: r.keyPrefix,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    isActive: r.isActive,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toExpiry(v: string | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid expiresAt date" });
  }
  return d;
}

export const apiKeyRouter = router({
  /** The published scope vocabulary (for the create dialog's multiselect). */
  scopes: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(() =>
      ALL_SCOPES.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
    ),

  /** List keys (newest first) — SAFE shape only (no hash, no plaintext). */
  list: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const d = await db();
      const rows = await d.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
      return rows.map(publicRow);
    }),

  /**
   * Mint a new scoped key. Returns the PLAINTEXT key EXACTLY ONCE — it is not
   * stored and can never be retrieved again. Only the SHA-256 hash is persisted.
   */
  create: protectedProcedure
    .use(requirePermission("admin_system", "canCreate"))
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(2000).nullish(),
        scopes: scopeSchema,
        expiresAt: z.union([z.string(), z.date()]).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const { plaintext, prefix } = generateKey();
      const keyHash = hashApiKey(plaintext);
      const [row] = await d
        .insert(apiKeys)
        .values({
          name: input.name.trim(),
          description: input.description ?? null,
          keyHash,
          keyPrefix: prefix,
          scopes: input.scopes,
          isActive: true,
          expiresAt: toExpiry(input.expiresAt),
          createdBy: ctx.user?.id ?? null,
        })
        .returning();
      // The plaintext is surfaced HERE ONLY — never persisted, never returned again.
      return { ...publicRow(row), plaintextKey: plaintext };
    }),

  /** Edit name/description/scopes/expiry/active flag. NEVER returns the hash. */
  update: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).nullish(),
        scopes: scopeSchema.optional(),
        expiresAt: z.union([z.string(), z.date()]).nullish(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [existing] = await d.select().from(apiKeys).where(eq(apiKeys.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `API key ${input.id} not found` });

      const patch: Partial<typeof apiKeys.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description ?? null;
      if (input.scopes !== undefined) patch.scopes = input.scopes;
      if (input.isActive !== undefined) patch.isActive = input.isActive;
      if (input.expiresAt !== undefined) patch.expiresAt = toExpiry(input.expiresAt);

      const [row] = await d.update(apiKeys).set(patch).where(eq(apiKeys.id, input.id)).returning();
      return publicRow(row);
    }),

  /** Revoke a key (isActive=false) — the auth middleware denies inactive keys. */
  revoke: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const [row] = await d
        .update(apiKeys)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(apiKeys.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `API key ${input.id} not found` });
      return publicRow(row);
    }),

  /** Permanently delete a key row. */
  delete: protectedProcedure
    .use(requirePermission("admin_system", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const removed = await d.delete(apiKeys).where(eq(apiKeys.id, input.id)).returning();
      if (removed.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: `API key ${input.id} not found` });
      }
      return { id: input.id, deleted: true };
    }),
});
