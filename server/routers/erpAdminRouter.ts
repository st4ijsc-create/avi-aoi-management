/**
 * Automation Orchestration K0+-d (doc 16 §4 Khối 0 / doc 18 §6) — ERP GATEWAY
 * ADMIN router (key "erpAdmin").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Admin surface over the K0+ ERP-hardening machinery:
 *   • OAuth2 clients (erp_oauth_clients) — list / create (secret shown once) /
 *     rotate secret / enable-disable. Mirrors apiKeyRouter's SHOW-ONCE + sha256
 *     hash-only security (REUSES hashApiKey — the SAME algorithm erpOauth verifies).
 *   • Outbox operations — status counts / dead-letter list (reads), retry
 *     dead-letters (mutation), circuit-breaker snapshot (read).
 *
 * RBAC (module-level): admin_system. Reads → canView; client writes →
 * canCreate/canEdit; dead-letter retry → canEdit. Fail-safe: a missing DB throws a
 * clean INTERNAL_SERVER_ERROR, never a silent grant.
 *
 * FLAG DISCIPLINE: the mutations that arm the OAuth path are additionally gated by
 * ERP_OAUTH_ENABLED — creating/rotating a client while the flow is OFF is refused
 * with a clear PRECONDITION_FAILED (nothing half-armed). Reads are always allowed
 * (so an admin can inspect state before enabling the flag).
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
import { erpOauthClients } from "../../drizzle/schema";
import { hashApiKey } from "../api/v1/auth";
import { erpOauthEnabled } from "../api/v1/erpOauth";
import { outboxStats, breakerSnapshot, retryDeadLetters, listDeadLetters } from "../services/integration/erpOutbox";
import { ALL_SCOPES } from "../api/v1/scopes";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Validate a scope grant: known scope, "<ns>:*" wildcard, or "*". */
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
  .refine((arr) => arr.every(isValidScopeGrant), { message: "One or more scopes are not in the published scope vocabulary" });

/** Generate a client_id + client_secret pair. */
function generateClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = `erpc_${randomBytes(9).toString("hex")}`; // 18 hex chars
  const clientSecret = `erps_${randomBytes(24).toString("hex")}`; // 48 hex chars
  return { clientId, clientSecret };
}

/** SAFE projection (NEVER exposes clientSecretHash). */
function publicClient(r: typeof erpOauthClients.$inferSelect) {
  return {
    id: r.id,
    clientId: r.clientId,
    name: r.name,
    description: r.description,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    enabled: r.enabled,
    corporateCode: r.corporateCode,
    createdBy: r.createdBy,
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function ensureOauthEnabled() {
  if (!erpOauthEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "OAuth2 client-credentials is disabled (ERP_OAUTH_ENABLED). Enable the flag before provisioning clients.",
    });
  }
}

export const erpAdminRouter = router({
  // ── OAuth clients ───────────────────────────────────────────────────────────

  /** List OAuth clients (newest first) — SAFE shape only (no secret hash). */
  listOauthClients: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const d = await db();
      const rows = await d.select().from(erpOauthClients).orderBy(desc(erpOauthClients.createdAt));
      return rows.map(publicClient);
    }),

  /**
   * Mint a new OAuth client. Returns the PLAINTEXT client_secret EXACTLY ONCE — it
   * is never stored or returned again (only its SHA-256 hash is persisted).
   * Gated by ERP_OAUTH_ENABLED (writes only).
   */
  createOauthClient: protectedProcedure
    .use(requirePermission("admin_system", "canCreate"))
    .input(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(2000).nullish(),
        scopes: scopeSchema,
        corporateCode: z.string().max(50).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      ensureOauthEnabled();
      const d = await db();
      const { clientId, clientSecret } = generateClientCredentials();
      const [row] = await d
        .insert(erpOauthClients)
        .values({
          clientId,
          clientSecretHash: hashApiKey(clientSecret),
          name: input.name.trim(),
          description: input.description ?? null,
          scopes: input.scopes,
          enabled: true,
          corporateCode: input.corporateCode ?? null,
          createdBy: ctx.user?.id ?? null,
        })
        .returning();
      // Plaintext secret surfaced HERE ONLY — never persisted, never returned again.
      return { ...publicClient(row), clientSecret };
    }),

  /** Rotate a client's secret. Returns the NEW plaintext secret ONCE. Gated. */
  rotateOauthClientSecret: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      ensureOauthEnabled();
      const d = await db();
      const [existing] = await d.select().from(erpOauthClients).where(eq(erpOauthClients.id, input.id)).limit(1);
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "oauthClient" }, `OAuth client ${input.id} not found`);
      const clientSecret = `erps_${randomBytes(24).toString("hex")}`;
      const [row] = await d
        .update(erpOauthClients)
        .set({ clientSecretHash: hashApiKey(clientSecret), updatedAt: new Date() })
        .where(eq(erpOauthClients.id, input.id))
        .returning();
      return { ...publicClient(row), clientSecret };
    }),

  /** Enable/disable a client (disabled → token endpoint refuses it). */
  setOauthClientEnabled: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const [row] = await d
        .update(erpOauthClients)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(erpOauthClients.id, input.id))
        .returning();
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "oauthClient" }, `OAuth client ${input.id} not found`);
      return publicClient(row);
    }),

  /** Edit scopes/name/description on an existing client. */
  updateOauthClient: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).nullish(),
        scopes: scopeSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [existing] = await d.select().from(erpOauthClients).where(eq(erpOauthClients.id, input.id)).limit(1);
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "oauthClient" }, `OAuth client ${input.id} not found`);
      const patch: Partial<typeof erpOauthClients.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description ?? null;
      if (input.scopes !== undefined) patch.scopes = input.scopes;
      const [row] = await d.update(erpOauthClients).set(patch).where(eq(erpOauthClients.id, input.id)).returning();
      return publicClient(row);
    }),

  // ── Outbox operations ───────────────────────────────────────────────────────

  /** Outbox status counts + circuit-breaker snapshot (read). */
  outboxStatus: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const [counts, breakers] = await Promise.all([outboxStats(), Promise.resolve(breakerSnapshot())]);
      return { counts, breakers };
    }),

  /** Recent dead-letter rows (read). */
  outboxDeadLetters: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await listDeadLetters(input?.limit ?? 50);
      return { deadLetters: rows, count: rows.length };
    }),

  /** Requeue dead-letters (all, or a specific set) back to pending (mutation). */
  retryOutboxDeadLetters: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ ids: z.array(z.number().int().positive()).optional() }).optional())
    .mutation(async ({ input }) => {
      return retryDeadLetters(input?.ids);
    }),
});
