/**
 * Automation Orchestration K0+-a (doc 16 §4 Khối 0 / doc 18 §6) — OAuth2
 * CLIENT-CREDENTIALS for ERP/MES partners + an mTLS honest seam.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ADDITIVE, least-privilege machine-to-machine auth ADDED ALONGSIDE the existing
 * API-key / bearer / MASTER_API_KEY path (server/api/v1/auth.ts) — it does NOT
 * replace it. A registered ERP client (erp_oauth_clients) exchanges its
 * client_id + client_secret at POST /api/v1/oauth/token for a SHORT-LIVED signed
 * JWT (HS256 via `jose`, matching server/_core/sdk.ts) carrying its granted
 * scopes. That token is then accepted as an alternative Bearer credential on the
 * inbound endpoints (/orders, /bom).
 *
 * TOKEN TYPE — signed JWT (HS256, `jose`) NOT an opaque DB token, because:
 *   • `jose` is already a dependency (no new dep), and HS256 JWT is the codebase's
 *     established signed-token pattern (sdk.ts session tokens);
 *   • stateless verification (no DB round-trip on every inbound request) — the
 *     signature + `exp` are self-contained; scopes travel in the claim.
 * The signing secret reuses the SAME HMAC secret the platform already trusts for
 * signed tokens (SESSION_SECRET / MASTER_API_KEY fallback) — no new secret to
 * provision. Tokens are namespaced by issuer `erp-gateway` + audience `erp-inbound`
 * so an ERP token can NEVER be confused with a user session cookie.
 *
 * FLAG: ERP_OAUTH_ENABLED (default OFF). When off, /oauth/token returns a
 * structured `oauth_disabled` envelope and the inbound endpoints simply never see
 * an OAuth token (they fall back to the existing auth). Nothing is weakened.
 *
 * mTLS: transport-level (client certificate) — see the honest seam at the bottom.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { urlencoded, type Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";
import type { ApiPrincipal } from "./auth";
import { hashApiKey } from "./auth";
import { UNDECLARED_TENANT_SCOPE } from "./apiKeyScope";

// ── Constants ────────────────────────────────────────────────────────────────

const TOKEN_ISSUER = "erp-gateway";
const TOKEN_AUDIENCE = "erp-inbound";

/** True when the OAuth2 client-credentials flow is enabled (default OFF). */
export function erpOauthEnabled(): boolean {
  return process.env.ERP_OAUTH_ENABLED === "true" || process.env.ERP_OAUTH_ENABLED === "1";
}

/** Access-token TTL in seconds (env-overridable; default 15 min, clamped 60s–24h). */
export function tokenTtlSeconds(): number {
  const v = Number(process.env.ERP_OAUTH_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(v) || v <= 0) return 15 * 60;
  return Math.min(Math.max(Math.floor(v), 60), 24 * 60 * 60);
}

/**
 * The HMAC signing key for ERP tokens. Reuses the platform's existing trusted
 * secret (SESSION_SECRET → MASTER_API_KEY → a documented dev fallback) so no new
 * secret has to be provisioned. Returned as bytes for `jose`.
 */
function getSigningSecret(): Uint8Array {
  const raw =
    process.env.ERP_OAUTH_SIGNING_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.MASTER_API_KEY ||
    "dev-erp-oauth-signing-secret-change-me";
  return new TextEncoder().encode(raw);
}

// ── Token issue / verify (pure, testable) ────────────────────────────────────

export interface IssuedToken {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scope: string;
}

/**
 * Issue a short-lived signed JWT for a client_credentials grant. Pure aside from
 * time — exported so tests can issue+verify without HTTP.
 */
export async function issueToken(clientId: string, scopes: string[]): Promise<IssuedToken> {
  const ttl = tokenTtlSeconds();
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({ scope: scopes, clientId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(clientId)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttl)
    .sign(getSigningSecret());
  return { accessToken, tokenType: "Bearer", expiresIn: ttl, scope: scopes.join(" ") };
}

export interface VerifiedToken {
  clientId: string;
  scopes: string[];
}

/**
 * Verify a bearer credential AS an ERP OAuth token. Returns the client + scopes
 * on success, or null if it is not a valid/current ERP token (bad signature,
 * wrong issuer/audience, expired, malformed). NEVER throws — a non-token bearer
 * (e.g. a plain API key) simply returns null so the caller falls back to the
 * existing API-key auth path.
 */
export async function verifyToken(token: string): Promise<VerifiedToken | null> {
  if (!token || token.split(".").length !== 3) return null; // not a JWS → not our token
  try {
    const { payload } = await jwtVerify(token, getSigningSecret(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    const clientId = typeof payload.clientId === "string" ? payload.clientId : (payload.sub as string | undefined);
    if (!clientId) return null;
    const scopes = Array.isArray(payload.scope)
      ? (payload.scope as unknown[]).filter((s): s is string => typeof s === "string")
      : typeof payload.scope === "string"
        ? payload.scope.split(/\s+/).filter(Boolean)
        : [];
    return { clientId, scopes };
  } catch {
    return null; // expired / bad signature / not our token → fall back to API-key auth
  }
}

/**
 * Adapt a verified ERP token to the shared ApiPrincipal shape so the existing
 * requireScope pipeline (scopeSatisfied) works unchanged. Called from auth.ts.
 */
export function tokenToPrincipal(v: VerifiedToken): ApiPrincipal {
  // mig 0325 — phạm vi tenant CHƯA KHAI. Token ERP mang `scope` (làm được gì) nhưng KHÔNG
  // mang một claim nào nói *thấy được gì*; `erp_oauth_clients` cũng chưa có cột tenant. Suy
  // ra "toàn cục" từ chỗ vắng mặt ấy là đúng lớp lỗi 0325 đang đóng, nên fail-closed: một
  // client ERP muốn đọc BI/export sẽ bị 403 cho tới khi có đường khai phạm vi cho nó (nợ đã
  // ghi lại — hôm nay các tuyến ERP chỉ dùng `erp:write`, không chạm `bi:read`/`export:read`).
  return { kind: "oauth", name: v.clientId, scopes: v.scopes, tenantScope: UNDECLARED_TENANT_SCOPE };
}

// ── Constant-time secret compare ─────────────────────────────────────────────

/** Constant-time compare of a presented secret's hash to the stored hash. */
function secretMatches(presentedSecret: string, storedHash: string): boolean {
  const presentedHash = hashApiKey(presentedSecret);
  const a = Buffer.from(presentedHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Client lookup ────────────────────────────────────────────────────────────

interface OauthClientRow {
  id: number;
  clientId: string;
  clientSecretHash: string;
  scopes: string[];
  enabled: boolean;
}

/** Load an enabled OAuth client by clientId. Fail-safe → null. */
async function loadClient(clientId: string): Promise<OauthClientRow | null> {
  try {
    const { getDb } = await import("../../db/connection");
    const { erpOauthClients } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(erpOauthClients).where(eq(erpOauthClients.clientId, clientId)).limit(1);
    const row = rows[0];
    if (!row || !row.enabled) return null;
    // best-effort lastUsedAt bump (never blocks the grant)
    db.update(erpOauthClients).set({ lastUsedAt: new Date() }).where(eq(erpOauthClients.id, row.id)).catch(() => undefined);
    return {
      id: row.id,
      clientId: row.clientId,
      clientSecretHash: row.clientSecretHash,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      enabled: row.enabled,
    };
  } catch (err) {
    console.error("[erpOauth] loadClient failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// ── Endpoint handler ─────────────────────────────────────────────────────────

/**
 * POST /api/v1/oauth/token — RFC 6749 §4.4 client_credentials grant. Accepts
 * credentials in the form body (`client_id`/`client_secret`/`grant_type`) or via
 * an HTTP Basic Authorization header. Issues a short-lived JWT on success.
 */
async function handleTokenRequest(req: Request, res: Response): Promise<void> {
  if (!erpOauthEnabled()) {
    // OAuth error shape (RFC 6749 §5.2) + our envelope's structured error.
    sendError(res, 503, "oauth_disabled", "OAuth2 client-credentials is disabled (ERP_OAUTH_ENABLED).", { phase: "K0+" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const grantType = typeof body.grant_type === "string" ? body.grant_type : undefined;
  if (grantType !== "client_credentials") {
    throw new ApiHttpError(400, "unsupported_grant_type", "Only grant_type=client_credentials is supported.");
  }

  // Credentials from body or HTTP Basic (RFC 6749 §2.3.1).
  let clientId = typeof body.client_id === "string" ? body.client_id : undefined;
  let clientSecret = typeof body.client_secret === "string" ? body.client_secret : undefined;
  const authHeader = req.header("authorization") || req.header("Authorization");
  if ((!clientId || !clientSecret) && authHeader && /^basic\s+/i.test(authHeader)) {
    try {
      const decoded = Buffer.from(authHeader.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = clientId || decoded.slice(0, idx);
        clientSecret = clientSecret || decoded.slice(idx + 1);
      }
    } catch {
      /* ignore malformed basic header */
    }
  }

  if (!clientId || !clientSecret) {
    throw new ApiHttpError(400, "invalid_request", "client_id and client_secret are required.");
  }

  const client = await loadClient(clientId);
  // Uniform failure (do not distinguish unknown client vs bad secret).
  if (!client || !secretMatches(clientSecret, client.clientSecretHash)) {
    throw new ApiHttpError(401, "invalid_client", "Client authentication failed.");
  }

  // Optional `scope` narrowing: requested scopes must be a subset of granted.
  let scopes = client.scopes;
  if (typeof body.scope === "string" && body.scope.trim()) {
    const requested = body.scope.trim().split(/\s+/);
    const granted = new Set(client.scopes);
    const narrowed = requested.filter((s) => granted.has(s) || granted.has("*"));
    if (narrowed.length === 0) {
      throw new ApiHttpError(400, "invalid_scope", "None of the requested scopes are granted to this client.");
    }
    scopes = narrowed;
  }

  const issued = await issueToken(client.clientId, scopes);
  // RFC 6749 token response fields, wrapped in the platform envelope.
  sendOk(res, {
    access_token: issued.accessToken,
    token_type: issued.tokenType,
    expires_in: issued.expiresIn,
    scope: issued.scope,
  });
}

/** Register the OAuth2 token endpoint on the /api/v1 router. */
export function registerErpOauthRoutes(r: Router): void {
  // Accept the RFC-standard application/x-www-form-urlencoded body IN ADDITION to
  // JSON (the parent router already applied json()). Both populate req.body.
  r.post("/oauth/token", urlencoded({ extended: false }), wrap(handleTokenRequest));
}
