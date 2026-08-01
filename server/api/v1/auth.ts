/**
 * Phase E1 — Unified Machine API: SCOPED API-KEY authentication middleware.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Authenticates every /api/v1 request from one of:
 *   1. MASTER_API_KEY  → super-key, ALL scopes (reuses _core/masterKey validation).
 *   2. A row in `api_keys` (SHA-256 hash match, active, not expired) → its scopes[].
 *   3. A DB-registered per-machine `apiKey` → narrow ingest:write scope only
 *      (lets existing machine clients post inspections without a new credential).
 *
 * Credential transport: `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 *
 * Each endpoint wraps itself with `requireScope(scope)`; missing auth → 401,
 * insufficient scope → 403. Fail-safe: any verification error denies (never 500s
 * the request, never grants by accident).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db";
import { apiKeys } from "../../../drizzle/schema";
import { isValidMasterKey } from "../../_core/masterKey";
import { getMachineByApiKey } from "../../db";
import { sendError } from "./envelope";
import { ALL_SCOPES, scopeSatisfied, type ApiScope } from "./scopes";

/** The authenticated principal attached to the request after auth succeeds. */
export interface ApiPrincipal {
  kind: "master" | "api-key" | "machine" | "oauth";
  /** Display name / id of the principal (for audit/logging). */
  name: string;
  /** Granted scopes (master & machine principals get a synthetic set). */
  scopes: string[];
  /** For machine principals, the resolved machine id (used by ingest). */
  machineId?: number;
  apiKeyId?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiPrincipal?: ApiPrincipal;
    }
  }
}

/** SHA-256 hex of a plaintext key (matches how api_keys.keyHash is stored). */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Extract the bearer/X-API-Key credential from the request, or null. */
function extractKey(req: Request): string | null {
  const auth = req.header("authorization") || req.header("Authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^bearer\s+/i, "").trim();
    if (tok) return tok;
  }
  const xkey = req.header("x-api-key") || req.header("X-API-Key");
  if (xkey && xkey.trim()) return xkey.trim();
  return null;
}

/**
 * Resolve a plaintext credential to an ApiPrincipal, or null if unrecognised.
 * Tries: master key → api_keys table → per-machine apiKey. Never throws.
 */
export async function resolvePrincipal(key: string): Promise<ApiPrincipal | null> {
  // 0) OAuth2 client-credentials token (K0+-a) — ADDITIVE, flag-gated.
  //    Only attempted when ERP_OAUTH_ENABLED is on AND the credential looks like a
  //    JWS (three dot-separated segments). verifyToken returns null for anything
  //    that is not a valid/current ERP token, so a plain API key falls straight
  //    through to the existing paths below — existing auth is NEVER weakened.
  try {
    const { erpOauthEnabled, verifyToken, tokenToPrincipal } = await import("./erpOauth");
    if (erpOauthEnabled() && key.split(".").length === 3) {
      const verified = await verifyToken(key);
      if (verified) return tokenToPrincipal(verified);
    }
  } catch {
    /* fall through — never let OAuth resolution break the existing auth chain */
  }

  // 1) Master super-key.
  try {
    if (isValidMasterKey(key)) {
      return { kind: "master", name: "master", scopes: ["*"] };
    }
  } catch {
    /* fall through */
  }

  // 2) Scoped api_keys table (hash match, active, not expired).
  try {
    const db = await getDb();
    if (db) {
      const hash = hashApiKey(key);
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.isActive, true)))
        .limit(1);
      const row = rows[0];
      if (row) {
        if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
          return null; // expired → deny
        }
        // best-effort lastUsedAt bump (never blocks the request)
        db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => undefined);
        return {
          kind: "api-key",
          name: row.name,
          scopes: Array.isArray(row.scopes) ? row.scopes : [],
          apiKeyId: row.id,
        };
      }
    }
  } catch (err) {
    console.error("[api/v1 auth] api_keys lookup failed:", (err as Error)?.message ?? err);
  }

  // 3) Per-machine apiKey (existing machine clients) → ingest:write only.
  try {
    const machine = await getMachineByApiKey(key);
    if (machine) {
      return { kind: "machine", name: machine.code, scopes: ["ingest:write"], machineId: machine.id };
    }
  } catch (err) {
    console.error("[api/v1 auth] machine apiKey lookup failed:", (err as Error)?.message ?? err);
  }

  return null;
}

/**
 * Express middleware factory: authenticate, then require `scope`.
 *   • no credential / unknown credential → 401
 *   • authenticated but scope not granted → 403
 * On success the principal is attached as `req.apiPrincipal` and `next()` runs.
 */
export function requireScope(scope: ApiScope) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = extractKey(req);
    if (!key) {
      sendError(res, 401, "unauthorized", "Missing API key. Provide Authorization: Bearer <key> or X-API-Key.");
      return;
    }
    let principal: ApiPrincipal | null = null;
    try {
      principal = await resolvePrincipal(key);
    } catch {
      principal = null;
    }
    if (!principal) {
      sendError(res, 401, "unauthorized", "Invalid or expired API key.");
      return;
    }
    if (!scopeSatisfied(principal.scopes, scope)) {
      sendError(res, 403, "forbidden", `This API key lacks the required scope "${scope}".`, {
        required: scope,
        granted: principal.scopes,
      });
      return;
    }
    req.apiPrincipal = principal;
    next();
  };
}

/** The full scope catalog (for the OpenAPI doc / a future self-describe endpoint). */
export const PUBLISHED_SCOPES = ALL_SCOPES;
