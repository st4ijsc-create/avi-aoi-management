/**
 * Federation — Sites Registry router (key "sites"). Doc 13 / F0.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Admin CRUD over the `sites` table: the CORE control-tower's registry of remote
 * (and local self-enrolled) platform deployments it will later poll read-only
 * for KPI roll-up (F1). F0 here = registry + enrollment + probe ONLY — no
 * aggregator, no roll-up, no writes to any site.
 *
 * SECURITY (non-negotiable):
 *   • Per-site read tokens are NEVER stored in the DB — only a reference
 *     (`authTokenRef`). The secret is resolved at probe time from env
 *     `SITE_TOKEN_<CODE>` via resolveSiteToken() (mirrors MASTER_API_KEY).
 *   • `probe` issues a single read-only GET to the site's /api/external/health.
 *     There is NO code path here that writes to a site.
 *
 * RBAC: adminProcedure (canonical 2FA-enforced admin from _core/trpc.ts).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { sites, SITE_STATUSES, SITE_AUTH_TYPES } from "../../drizzle/schema";
import { resolveSiteToken, siteTokenEnvVar, hasSiteToken } from "../services/federation/secretStore";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Project a row to the public shape. Never exposes a raw secret (we never store one). */
function publicRow(r: typeof sites.$inferSelect) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    corporateCode: r.corporateCode,
    baseUrl: r.baseUrl,
    region: r.region,
    authType: r.authType,
    authTokenRef: r.authTokenRef,
    unsBrokerUrl: r.unsBrokerUrl,
    pollIntervalSec: r.pollIntervalSec,
    status: r.status,
    isLocal: r.isLocal,
    lastSyncAt: r.lastSyncAt,
    lastError: r.lastError,
    consecutiveFailures: r.consecutiveFailures,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // Honest config signal: is a read token actually resolvable for this site?
    hasToken: hasSiteToken(r.code, { isLocal: r.isLocal }),
    tokenEnvVar: siteTokenEnvVar(r.code),
  };
}

const codeSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Code may contain only letters, digits, '-' and '_'");

const baseUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "baseUrl must start with http:// or https://");

/** Normalize a base URL (strip trailing slashes) so /api/external/* joins cleanly. */
function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

/**
 * Probe a site's read-only health endpoint using its env-resolved token.
 * Updates status/lastError/lastSyncAt/consecutiveFailures. Never writes to the
 * site. Returns the probe outcome.
 */
async function probeSite(row: typeof sites.$inferSelect): Promise<{
  ok: boolean;
  httpStatus?: number;
  error?: string;
}> {
  const token = resolveSiteToken(row.code, { isLocal: row.isLocal });
  if (!token) {
    return { ok: false, error: `No read token configured (set env ${siteTokenEnvVar(row.code)})` };
  }

  const url = `${normalizeBaseUrl(row.baseUrl)}/api/external/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers: Record<string, string> =
      row.authType === "bearer"
        ? { Authorization: `Bearer ${token}` }
        : { "x-master-key": token };

    const resp = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!resp.ok) {
      return { ok: false, httpStatus: resp.status, error: `Health returned HTTP ${resp.status}` };
    }
    // Best-effort body check; a 200 is sufficient to count as reachable.
    let bodyOk = true;
    try {
      const body: any = await resp.json();
      if (body && typeof body === "object" && body.success === false) bodyOk = false;
    } catch {
      /* non-JSON 200 is still "reachable" */
    }
    return bodyOk
      ? { ok: true, httpStatus: resp.status }
      : { ok: false, httpStatus: resp.status, error: "Health reported success:false" };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Probe timed out after 15s" : e?.message || "Probe failed";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

export const sitesRouter = router({
  /** List all sites (newest first). */
  list: adminProcedure.query(async () => {
    const d = await db();
    const rows = await d.select().from(sites).orderBy(desc(sites.createdAt));
    return rows.map(publicRow);
  }),

  /** Get one site by id. */
  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "site" }, `Site ${input.id} not found`);
      return publicRow(row);
    }),

  /** Create a site. The token itself is NOT accepted/stored — only a ref. */
  create: adminProcedure
    .input(
      z.object({
        code: codeSchema,
        name: z.string().min(1).max(255),
        corporateCode: z.string().max(50).nullish(),
        baseUrl: baseUrlSchema,
        region: z.string().max(100).nullish(),
        authType: z.enum(SITE_AUTH_TYPES).default("master_key"),
        unsBrokerUrl: z.string().max(2048).nullish(),
        pollIntervalSec: z.number().int().min(10).max(86_400).default(60),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [existing] = await d.select().from(sites).where(eq(sites.code, input.code)).limit(1);
      if (existing) throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "site" }, `Site code '${input.code}' already exists`);

      const [row] = await d
        .insert(sites)
        .values({
          code: input.code,
          name: input.name.trim(),
          corporateCode: input.corporateCode ?? null,
          baseUrl: normalizeBaseUrl(input.baseUrl),
          region: input.region ?? null,
          authType: input.authType,
          // Store only a REFERENCE to where the secret lives — never the secret.
          authTokenRef: siteTokenEnvVar(input.code),
          unsBrokerUrl: input.unsBrokerUrl ?? null,
          pollIntervalSec: input.pollIntervalSec,
          status: "unknown",
          isLocal: false,
        })
        .returning();
      return publicRow(row);
    }),

  /** Edit a site (config only — never a raw secret). */
  update: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        corporateCode: z.string().max(50).nullish(),
        baseUrl: baseUrlSchema.optional(),
        region: z.string().max(100).nullish(),
        authType: z.enum(SITE_AUTH_TYPES).optional(),
        unsBrokerUrl: z.string().max(2048).nullish(),
        pollIntervalSec: z.number().int().min(10).max(86_400).optional(),
        status: z.enum(SITE_STATUSES).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const [existing] = await d.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "site" }, `Site ${input.id} not found`);

      const patch: Partial<typeof sites.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.corporateCode !== undefined) patch.corporateCode = input.corporateCode ?? null;
      if (input.baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(input.baseUrl);
      if (input.region !== undefined) patch.region = input.region ?? null;
      if (input.authType !== undefined) patch.authType = input.authType;
      if (input.unsBrokerUrl !== undefined) patch.unsBrokerUrl = input.unsBrokerUrl ?? null;
      if (input.pollIntervalSec !== undefined) patch.pollIntervalSec = input.pollIntervalSec;
      if (input.status !== undefined) patch.status = input.status;

      const [row] = await d.update(sites).set(patch).where(eq(sites.id, input.id)).returning();
      return publicRow(row);
    }),

  /** Delete a site. */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const removed = await d.delete(sites).where(eq(sites.id, input.id)).returning();
      if (removed.length === 0) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "site" }, `Site ${input.id} not found`);
      return { id: input.id, deleted: true };
    }),

  /**
   * Probe a site's read-only /api/external/health using its env-resolved token,
   * then persist the outcome (status / lastError / lastSyncAt / failures).
   */
  probe: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const d = await db();
      const [row] = await d.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "site" }, `Site ${input.id} not found`);

      const result = await probeSite(row);
      const now = new Date();
      const [updated] = await d
        .update(sites)
        .set(
          result.ok
            ? { status: "active", lastError: null, lastSyncAt: now, consecutiveFailures: 0, updatedAt: now }
            : {
                status: "error",
                lastError: result.error ?? "Probe failed",
                consecutiveFailures: (row.consecutiveFailures ?? 0) + 1,
                updatedAt: now,
              },
        )
        .where(eq(sites.id, input.id))
        .returning();

      return { ...publicRow(updated), probe: result };
    }),

  /**
   * Self-enroll THIS deployment as a local site (isLocal=true) so the UI / future
   * aggregator works with a single deployment ("degrade honestly with 1 site").
   * Idempotent on a fixed local code; token resolves to MASTER_API_KEY via
   * resolveSiteToken(..., { isLocal: true }).
   */
  selfEnrollLocal: adminProcedure
    .input(
      z.object({
        code: codeSchema.optional(),
        name: z.string().min(1).max(255).optional(),
        corporateCode: z.string().max(50).nullish(),
        baseUrl: baseUrlSchema.optional(),
        region: z.string().max(100).nullish(),
      }).optional(),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      const code = (input?.code ?? "LOCAL").toUpperCase();
      const port = process.env.PORT || "3000";
      const baseUrl = normalizeBaseUrl(
        input?.baseUrl || process.env.SITE_SELF_BASE_URL || `http://localhost:${port}`,
      );

      const [existing] = await d.select().from(sites).where(eq(sites.code, code)).limit(1);
      if (existing) {
        // Refresh the existing local row's pointer/config rather than duplicating.
        const [row] = await d
          .update(sites)
          .set({
            name: input?.name?.trim() || existing.name,
            corporateCode: input?.corporateCode ?? existing.corporateCode,
            baseUrl,
            region: input?.region ?? existing.region,
            isLocal: true,
            authTokenRef: siteTokenEnvVar(code),
            updatedAt: new Date(),
          })
          .where(eq(sites.id, existing.id))
          .returning();
        return { ...publicRow(row), created: false };
      }

      const [row] = await d
        .insert(sites)
        .values({
          code,
          name: input?.name?.trim() || "This deployment (local)",
          corporateCode: input?.corporateCode ?? null,
          baseUrl,
          region: input?.region ?? null,
          authType: "master_key",
          authTokenRef: siteTokenEnvVar(code),
          pollIntervalSec: 60,
          status: "unknown",
          isLocal: true,
        })
        .returning();
      return { ...publicRow(row), created: true };
    }),
});
